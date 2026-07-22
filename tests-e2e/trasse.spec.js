import { test, expect } from '@playwright/test';

test('dist: Trasse, Linien-Snap und Abschluss verändern vorhandenes Netz nicht automatisch', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(String(err)));
  await page.route(/tile\.openstreetmap\.org/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof window.startNewTrasseBranch === 'function');

  const result = await page.evaluate(() => {
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
    const lockedPruneResult = toggleEdgePruned(existingEdge);
    const lockedState = {
      clearResult: lockedClearResult,
      drawResult: lockedDrawResult,
      pruneResult: lockedPruneResult,
      edgeCount: window.netzEdges.length,
      drawingEdge: window.isDrawingEdge,
      pruned: existingEdge.pruned === true,
    };
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
      autoNetzVisible: [...document.querySelectorAll('button')].some(button => button.textContent.includes('Netz erzeugen')),
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
  expect(result.markerSurvivedDrag).toBe(true);
  expect(result.lockedState).toEqual({
    clearResult: false,
    drawResult: false,
    pruneResult: false,
    edgeCount: 1,
    drawingEdge: false,
    pruned: false,
  });
  expect(pageErrors).toHaveLength(0);
});
