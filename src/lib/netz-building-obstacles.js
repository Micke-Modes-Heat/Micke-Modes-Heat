// Geometrie-Hilfen für Wärmenetzleitungen an Gebäudegrundrissen.
// Für die kleinen Entfernungen eines Quartiers genügt die Rechnung direkt in
// Breiten-/Längengraden; alle Tests sind invariant gegenüber der Maßeinheit.

const EPSILON = 1e-11;

function xy(point) {
  return {
    x: Number(point?.lng ?? point?.[1]),
    y: Number(point?.lat ?? point?.[0]),
  };
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a, b, point) {
  return Math.abs(orientation(a, b, point)) <= EPSILON &&
    point.x >= Math.min(a.x, b.x) - EPSILON &&
    point.x <= Math.max(a.x, b.x) + EPSILON &&
    point.y >= Math.min(a.y, b.y) - EPSILON &&
    point.y <= Math.max(a.y, b.y) + EPSILON;
}

function segmentsIntersect(aRaw, bRaw, cRaw, dRaw) {
  const a = xy(aRaw), b = xy(bRaw), c = xy(cRaw), d = xy(dRaw);
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON)) &&
      ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) ||
    onSegment(c, d, a) || onSegment(c, d, b);
}

export function pointInBuildingPolygon(pointRaw, polygon) {
  if (!pointRaw || !Array.isArray(polygon) || polygon.length < 3) return false;
  const point = xy(pointRaw);
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = xy(polygon[index]), b = xy(polygon[previous]);
    if (onSegment(a, b, point)) return true;
    const crosses = ((a.y > point.y) !== (b.y > point.y)) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function segmentCrossesBuilding(start, end, polygon) {
  if (!start || !end || !Array.isArray(polygon) || polygon.length < 3) return false;
  if (pointInBuildingPolygon(start, polygon) || pointInBuildingPolygon(end, polygon)) return true;
  for (let index = 0; index < polygon.length; index++) {
    if (segmentsIntersect(start, end, polygon[index], polygon[(index + 1) % polygon.length])) {
      return true;
    }
  }
  const midpoint = {
    lat: (Number(start.lat) + Number(end.lat)) / 2,
    lng: (Number(start.lng) + Number(end.lng)) / 2,
  };
  return pointInBuildingPolygon(midpoint, polygon);
}

export function crossesForeignBuilding(start, end, buildings, allowedBuildingIds = []) {
  const allowed = new Set(allowedBuildingIds);
  return (buildings || []).some(building =>
    building?.polygon?.length >= 3 &&
    !allowed.has(building.id) &&
    segmentCrossesBuilding(start, end, building.polygon));
}

function segmentIntersectionParameter(startRaw, endRaw, aRaw, bRaw) {
  const start = xy(startRaw), end = xy(endRaw), a = xy(aRaw), b = xy(bRaw);
  const rx = end.x - start.x, ry = end.y - start.y;
  const sx = b.x - a.x, sy = b.y - a.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) <= EPSILON) return null;
  const qx = a.x - start.x, qy = a.y - start.y;
  const t = (qx * sy - qy * sx) / denominator;
  const u = (qx * ry - qy * rx) / denominator;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null;
  return Math.max(0, Math.min(1, t));
}

// Gebäudeknoten liegen aus Berechnungsgründen im Schwerpunkt. Für die sichtbare
// Leitung wird der Endpunkt auf die Außenkante in Richtung des nächsten
// Leitungsstützpunkts verschoben.
export function clipBuildingEndpoint(center, toward, polygon) {
  if (!center || !toward || !Array.isArray(polygon) || polygon.length < 3) return center;
  const parameters = [];
  for (let index = 0; index < polygon.length; index++) {
    const t = segmentIntersectionParameter(
      center, toward, polygon[index], polygon[(index + 1) % polygon.length],
    );
    if (t != null && t > EPSILON) parameters.push(t);
  }
  if (!parameters.length) return center;
  const t = Math.min(...parameters);
  return {
    lat: Number(center.lat) + (Number(toward.lat) - Number(center.lat)) * t,
    lng: Number(center.lng) + (Number(toward.lng) - Number(center.lng)) * t,
  };
}
