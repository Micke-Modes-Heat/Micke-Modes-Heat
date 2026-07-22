// @ts-check
// Zentrale, DOM-freie Prüfung und Migration von Projektdateien.
// Wichtig: Diese Funktionen verändern das Eingabeobjekt nicht.

export const PROJECT_SCHEMA_VERSION = 2;

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value */
function finiteNumber(value) {
  return typeof value === 'number' ? Number.isFinite(value) : Number.isFinite(Number(value));
}

/** @param {unknown} point @param {string} path @param {string[]} errors */
function validateLatLng(point, path, errors) {
  if (!isObject(point) || !finiteNumber(point.lat) || !finiteNumber(point.lng)) {
    errors.push(`${path}: gültige Koordinaten {lat, lng} erwartet`);
    return;
  }
  const lat = Number(point.lat), lng = Number(point.lng);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    errors.push(`${path}: Koordinaten außerhalb des gültigen Bereichs`);
  }
}

/**
 * Prüft die strukturellen Mindestanforderungen einer Projektdatei.
 * Die Detailmodelle werden schrittweise ergänzt; unbekannte Zusatzfelder bleiben erlaubt.
 * @param {unknown} input
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validateProjectData(input) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  if (!isObject(input)) return { ok: false, errors: ['Projektwurzel muss ein Objekt sein'], warnings };

  const p = /** @type {Record<string, any>} */ (input);
  if (!Number.isInteger(p.version)) errors.push('version: ganzzahlige Schema-Version fehlt');
  else if (p.version > PROJECT_SCHEMA_VERSION) errors.push(`version: ${p.version} ist neuer als unterstützt (${PROJECT_SCHEMA_VERSION})`);
  else if (p.version < 1) errors.push(`version: ${p.version} wird nicht unterstützt`);

  if (!Array.isArray(p.gebaeude)) errors.push('gebaeude: Array erwartet');
  else {
    const ids = new Set();
    p.gebaeude.forEach((g, i) => {
      const path = `gebaeude[${i}]`;
      if (!isObject(g)) { errors.push(`${path}: Objekt erwartet`); return; }
      if (!Number.isInteger(Number(g.id))) errors.push(`${path}.id: ganzzahlige ID erwartet`);
      else if (ids.has(Number(g.id))) errors.push(`${path}.id: doppelte Gebäude-ID ${g.id}`);
      else ids.add(Number(g.id));
      if (g.polygon != null) {
        if (!Array.isArray(g.polygon) || g.polygon.length < 3) errors.push(`${path}.polygon: mindestens drei Punkte erwartet`);
        else g.polygon.forEach((/** @type {unknown} */ pt, /** @type {number} */ j) => validateLatLng(pt, `${path}.polygon[${j}]`, errors));
      }
    });
  }

  if (p.trasse != null) {
    if (!Array.isArray(p.trasse)) errors.push('trasse: Array erwartet');
    else p.trasse.forEach((pt, i) => validateLatLng(pt, `trasse[${i}]`, errors));
  }
  if (p.trasseSegments != null) {
    if (!Array.isArray(p.trasseSegments)) errors.push('trasseSegments: Array erwartet');
    else p.trasseSegments.forEach((seg, i) => {
      if (!isObject(seg) || !Number.isInteger(seg.start) || !Number.isInteger(seg.end)) {
        errors.push(`trasseSegments[${i}]: ganzzahlige start/end-Werte erwartet`);
      } else if (seg.start < 0 || seg.end < seg.start || seg.end >= (p.trasse?.length || 0)) {
        errors.push(`trasseSegments[${i}]: ungültiger Punktebereich ${seg.start}..${seg.end}`);
      }
    });
  }

  if (p.customEdges != null && !Array.isArray(p.customEdges)) errors.push('customEdges: Array erwartet');
  if (p.waermeNetzGraph != null) {
    if (!isObject(p.waermeNetzGraph)) errors.push('waermeNetzGraph: Objekt erwartet');
    else {
      const graph = p.waermeNetzGraph;
      if (!Array.isArray(graph.nodes)) errors.push('waermeNetzGraph.nodes: Array erwartet');
      if (!Array.isArray(graph.edges)) errors.push('waermeNetzGraph.edges: Array erwartet');
      const nodeIds = new Set();
      (Array.isArray(graph.nodes) ? graph.nodes : []).forEach((node, i) => {
        const path = `waermeNetzGraph.nodes[${i}]`;
        if (!isObject(node) || !Number.isInteger(Number(node.id))) { errors.push(`${path}.id: ganzzahlige ID erwartet`); return; }
        const id = Number(node.id);
        if (nodeIds.has(id)) errors.push(`${path}.id: doppelte Knoten-ID ${id}`);
        nodeIds.add(id);
        validateLatLng(node, path, errors);
      });
      (Array.isArray(graph.edges) ? graph.edges : []).forEach((edge, i) => {
        const path = `waermeNetzGraph.edges[${i}]`;
        if (!isObject(edge) || !Number.isInteger(Number(edge.u)) || !Number.isInteger(Number(edge.v))) {
          errors.push(`${path}: ganzzahlige u/v-Knoten-IDs erwartet`); return;
        }
        if (!nodeIds.has(Number(edge.u)) || !nodeIds.has(Number(edge.v))) errors.push(`${path}: verweist auf unbekannten Knoten`);
        if (edge.waypoint != null) validateLatLng(edge.waypoint, `${path}.waypoint`, errors);
        if (edge.waypoints != null) {
          if (!Array.isArray(edge.waypoints)) errors.push(`${path}.waypoints: Array erwartet`);
          else edge.waypoints.forEach((point, j) => validateLatLng(point, `${path}.waypoints[${j}]`, errors));
        }
      });
    }
  }
  if (p.varianten != null && !Array.isArray(p.varianten)) errors.push('varianten: Array erwartet');
  if (p.phasen != null && !Array.isArray(p.phasen)) errors.push('phasen: Array erwartet');
  if (p.elektroAssets != null && !isObject(p.elektroAssets)) errors.push('elektroAssets: Objekt erwartet');
  if (p.stromNetz != null && !isObject(p.stromNetz)) errors.push('stromNetz: Objekt erwartet');

  if (!p.gebaeude?.length) warnings.push('Projekt enthält keine Gebäude');
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Validiert, migriert und klont eine Projektdatei für den Import.
 * @param {unknown} input
 * @returns {{project: Record<string, any>, warnings: string[]}}
 */
export function prepareProjectForImport(input) {
  const result = validateProjectData(input);
  if (!result.ok) {
    const err = new Error('Ungültige Projektdatei:\n' + result.errors.map(e => `• ${e}`).join('\n'));
    err.name = 'ProjectValidationError';
    throw err;
  }
  const project = structuredClone(/** @type {Record<string, any>} */ (input));
  const warnings = [...result.warnings];
  if (project.version === 1) {
    // v2 führt den vollständigen Wärmenetzgraphen und belastbare Autosave-
    // Metadaten ein. Alte Dateien bleiben strukturell unverändert nutzbar;
    // beim nächsten Export wird der Graph aus dem Laufzeitmodell ergänzt.
    project.version = 2;
    warnings.push('Projektdatei wurde von Schema v1 auf v2 migriert');
  }
  return { project, warnings };
}
