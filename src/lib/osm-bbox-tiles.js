// Große Overpass-Abfragen werden zuverlässiger, wenn das Gebiet in mehrere
// überschaubare Bounding Boxes zerlegt wird. Die Begrenzung je Achse verhindert
// zugleich eine unkontrollierte Zahl paralleler Serveranfragen.

export function splitOsmBbox(bbox, {targetMeters = 1400, maxTilesPerAxis = 4} = {}) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return [];
  const [south,west,north,east] = bbox.map(Number);
  if (![south,west,north,east].every(Number.isFinite) || north <= south || east <= west) return [];
  const meanLatRad = ((south + north) / 2) * Math.PI / 180;
  const heightM = (north - south) * 111320;
  const widthM = (east - west) * 111320 * Math.max(0.2,Math.cos(meanLatRad));
  const rows = Math.max(1,Math.min(maxTilesPerAxis,Math.ceil(heightM / targetMeters)));
  const columns = Math.max(1,Math.min(maxTilesPerAxis,Math.ceil(widthM / targetMeters)));
  const latStep = (north - south) / rows;
  const lngStep = (east - west) / columns;
  const tiles = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      tiles.push([
        south + row * latStep,
        west + column * lngStep,
        row === rows - 1 ? north : south + (row + 1) * latStep,
        column === columns - 1 ? east : west + (column + 1) * lngStep,
      ]);
    }
  }
  return tiles;
}

export function subdivideOsmBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return [];
  const [south,west,north,east] = bbox.map(Number);
  if (![south,west,north,east].every(Number.isFinite) || north <= south || east <= west) return [];
  const midLat = (south + north) / 2;
  const midLng = (west + east) / 2;
  return [
    [south,west,midLat,midLng],
    [south,midLng,midLat,east],
    [midLat,west,north,midLng],
    [midLat,midLng,north,east],
  ];
}

export function mergeOsmElements(results) {
  const elements = new Map();
  (results || []).forEach(result => {
    (result?.elements || []).forEach(element => {
      if (element?.type == null || element?.id == null) return;
      elements.set(`${element.type}:${element.id}`,element);
    });
  });
  return {elements:[...elements.values()]};
}
