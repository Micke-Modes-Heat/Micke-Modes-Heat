// ── 13s-wind-flaeche.js — Eignungsflächen-Raster für Windkraft (reine Geometrie, kein Leaflet) ──
// Rastert das Plangebiet und markiert jede Zelle als geeignet, wenn sie innerhalb des Plangebiets
// liegt UND mindestens boundaryM von der Plangebietsgrenze sowie radiusM von jedem Gebäude
// entfernt ist. Grenzabstand und Gebäude-/Anlagenabstand sind getrennt, weil real der große
// Planungsabstand (z.B. 5×Rotor-Ø) zur Wohnbebauung gilt, zur Gebietsgrenze aber nur die
// Kipphöhe (≈ Gesamthöhe) — sonst wird die Anlagenzahl im Gebiet massiv unterschätzt
// (validiert am Windpark Rosengarten II: 2 reale Anlagen auf ~150–240 ha).
// Grobe Näherung (quadratisches Raster statt echter Polygon-Erosion), reicht aber für eine
// Standort-Übersicht auf der Karte.

function toXY(pt, origin, mPerLat, mPerLng) {
  return [(pt.lng - origin.lng) * mPerLng, (pt.lat - origin.lat) * mPerLat];
}
function fromXY(x, y, origin, mPerLat, mPerLng) {
  return { lat: origin.lat + y / mPerLat, lng: origin.lng + x / mPerLng };
}

function pointInPolygonXY(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToPolygonBoundaryXY(x, y, poly) {
  let minD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    minD = Math.min(minD, Math.hypot(x - cx, y - cy));
  }
  return minD;
}

// polygonRing / buildingRings: Arrays aus {lat, lng}. radiusM: Mindestabstand zu Gebäuden;
// boundaryM: Mindestabstand zur Gebietsgrenze (Default: wie radiusM, für Altaufrufer).
export function computeSuitabilityGrid({ polygonRing, buildingRings = [], exclusionRings = [], radiusM, boundaryM = null, gridStepM = 20, maxCells = 6000 }) {
  const empty = { cells: [], areaM2: 0, gridStepM, truncated: false };
  if (!polygonRing || polygonRing.length < 3 || !(radiusM > 0)) return empty;
  const bndM = boundaryM > 0 ? boundaryM : radiusM;

  const origin  = polygonRing[0];
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  const polyXY  = polygonRing.map(p => toXY(p, origin, mPerLat, mPerLng));
  const buildingsXY = buildingRings
    .filter(r => r && r.length >= 3)
    .map(ring => ring.map(p => toXY(p, origin, mPerLat, mPerLng)));
  // Restriktions-Ausschlusszonen (Straßen/Bahn/Leitungen aus 13u) — der Abstand ist
  // bereits in die Ring-Geometrie einbaut, daher reicht hier ein reiner Innen-Test.
  const exclusionsXY = exclusionRings
    .filter(r => r && r.length >= 3)
    .map(ring => ring.map(p => toXY(p, origin, mPerLat, mPerLng)));

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of polyXY) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }

  const step = Math.max(5, gridStepM);
  const cells = [];
  let truncated = false;
  outer:
  for (let y = minY + step / 2; y <= maxY; y += step) {
    for (let x = minX + step / 2; x <= maxX; x += step) {
      if (!pointInPolygonXY(x, y, polyXY)) continue;
      if (distToPolygonBoundaryXY(x, y, polyXY) < bndM) continue;
      let blocked = false;
      for (const b of buildingsXY) {
        if (pointInPolygonXY(x, y, b) || distToPolygonBoundaryXY(x, y, b) < radiusM) { blocked = true; break; }
      }
      if (blocked) continue;
      for (const ex of exclusionsXY) {
        if (pointInPolygonXY(x, y, ex)) { blocked = true; break; }
      }
      if (blocked) continue;
      if (cells.length >= maxCells) { truncated = true; break outer; }
      cells.push(fromXY(x, y, origin, mPerLat, mPerLng));
    }
  }
  return { cells, areaM2: cells.length * step * step, gridStepM: step, truncated };
}

// Näherungs-Distanz zweier {lat,lng}-Punkte in Metern (flache Erde, für die kleinen
// Ausdehnungen eines Windgebiets ausreichend genau).
function distLatLngM(a, b) {
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const dy = (b.lat - a.lat) * mPerLat, dx = (b.lng - a.lng) * mPerLng;
  return Math.hypot(dx, dy);
}

// Platzierungsvorschläge: greedy Auswahl von Standorten aus dem Eignungsraster, die
// untereinander mindestens radiusM Abstand einhalten (Planungsabstand, z.B. 5×Rotor-Ø);
// zur Gebietsgrenze gilt der kleinere boundaryM (Kipphöhe). Kein echtes Optimum (z.B.
// Kreispackung), aber eine schnelle, robuste Näherung für eine Standort-Übersicht —
// Raster wird feiner als die Eignungsflächen-Darstellung gewählt, damit die Auswahl
// nicht unnötig lückenhaft ausfällt.
export function computeTurbinePlacements({ polygonRing, buildingRings = [], exclusionRings = [], radiusM, boundaryM = null, gridStepM, maxTurbines = 200 }) {
  const step = gridStepM || Math.max(15, Math.round(radiusM / 6));
  const grid = computeSuitabilityGrid({ polygonRing, buildingRings, exclusionRings, radiusM, boundaryM, gridStepM: step, maxCells: 20000 });
  const picked = [];
  for (const c of grid.cells) {
    let ok = true;
    for (const p of picked) {
      if (distLatLngM(c, p) < radiusM) { ok = false; break; }
    }
    if (ok) {
      picked.push(c);
      if (picked.length >= maxTurbines) break;
    }
  }
  return { points: picked, gridStepM: step, truncatedGrid: grid.truncated };
}
