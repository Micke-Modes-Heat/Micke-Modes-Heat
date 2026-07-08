// ── 14f-cluster-core.js — Liegenschafts-Cluster: Datenmodell, Mitglieder, Persistenz ──
// Schritt 1 des Klimafahrplan-/Ausbaustufen-Konzepts: die Liegenschaft geografisch
// in benannte Cluster (A, B, C … + zentral) gliedern. Ein Cluster ist ein Polygon
// auf der Karte plus eine Ausbaustufe (Stufe-Nr. + Fertigstellungsjahr). Die Mitglieder
// (Gebäude) werden NICHT gespeichert, sondern jederzeit aus der Geometrie abgeleitet
// (Punkt-in-Polygon des Gebäude-Schwerpunkts) — so bleiben Cluster konsistent, wenn sich
// Gebäude oder Polygone ändern.
//
// Entscheidung (2026-07-08): Cluster sind variantenübergreifend gleich (Geometrie + Zeit
// liegenschaftsweit, nicht in den Varianten-Snapshots). CO₂-KPIs je Stufe kommen später.
//
// Dieses Modul ist bewusst Leaflet-frei und rein → testbar (tests/cluster-core.test.js).
// Das Rendering/Zeichnen liegt in 14g-cluster-map.js.

// Cluster = {
//   id:      string,             — eindeutige ID
//   name:    string,             — Kürzel/Label, z.B. "A", "zentral"
//   farbe:   string,             — Hex-Farbe für Overlay + Badge
//   polygon: [{lat,lng}, …],     — Umriss (mind. 3 Punkte)
//   stufe:   number|null,        — Ausbaustufe (0–9), null = noch nicht zugeordnet
//   jahr:    number|null,        — Fertigstellung bis … (Jahr), null = offen
//   notiz:   string,             — freie Beschreibung der Maßnahmenpakete
// }

// Palette in Anlehnung an die Klimafahrplan-Slides (A=indigo, B=gelb, C=blau, …).
export const CLUSTER_PALETTE = [
  { name: 'A', farbe: '#5c6bc0' },
  { name: 'B', farbe: '#fdd835' },
  { name: 'C', farbe: '#1e88e5' },
  { name: 'D', farbe: '#fb8c00' },
  { name: 'E', farbe: '#8e24aa' },
  { name: 'F', farbe: '#43a047' },
  { name: 'G', farbe: '#f4511e' },
  { name: 'zentral', farbe: '#2e7d32' },
];

// WICHTIG: nie neu zuweisen (clusters = …) — das erzeugt in der teil-migrierten ESM-Welt
// stale Bindings (window.clusters vs. Modul-Binding). Immer in-place mutieren.
export const clusters = [];

// ── Geometrie-Helfer (planar auf lat/lng — für die kleinen Liegenschafts-Ausdehnungen
//    als Mitgliedschaftstest völlig ausreichend) ──────────────────────────────────────

function _pt(p) {
  // Normalisiert Leaflet-taugliche Punkte: [lat,lng] ODER {lat,lng}.
  if (Array.isArray(p)) return { lat: +p[0], lng: +p[1] };
  return { lat: +p.lat, lng: +p.lng };
}

export function pointInRingLL(pt, ring) {
  const p = _pt(pt);
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = _pt(ring[i]), b = _pt(ring[j]);
    const intersect = ((a.lat > p.lat) !== (b.lat > p.lat)) &&
      (p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function ringCentroidLL(ring) {
  if (!ring || !ring.length) return null;
  let sLat = 0, sLng = 0;
  for (const raw of ring) { const p = _pt(raw); sLat += p.lat; sLng += p.lng; }
  return { lat: sLat / ring.length, lng: sLng / ring.length };
}

// ── Mitglieder-Zuordnung ──────────────────────────────────────────────────────────────
// Gibt die IDs aller Gebäude zurück, deren Schwerpunkt im Cluster-Polygon liegt.
// gebaeudeArr: Array mit { id, polygon:[…] } (window.gebaeude).
export function clusterMitgliedIds(cluster, gebaeudeArr) {
  if (!cluster || !cluster.polygon || cluster.polygon.length < 3) return [];
  const out = [];
  for (const g of (gebaeudeArr || [])) {
    if (!g || !g.polygon || g.polygon.length < 3) continue;
    const c = ringCentroidLL(g.polygon);
    if (c && pointInRingLL(c, cluster.polygon)) out.push(g.id);
  }
  return out;
}

// Umgekehrt: welchem Cluster gehört ein Gebäude an? (Erstes Treffer-Cluster; überlappen
// sollten sich Cluster ohnehin nicht.) Gibt das Cluster-Objekt oder null.
export function clusterFuerGebaeude(g, clustersArr = clusters) {
  if (!g || !g.polygon || g.polygon.length < 3) return null;
  const c = ringCentroidLL(g.polygon);
  if (!c) return null;
  for (const cl of clustersArr) {
    if (cl.polygon && cl.polygon.length >= 3 && pointInRingLL(c, cl.polygon)) return cl;
  }
  return null;
}

// ── CRUD ────────────────────────────────────────────────────────────────────────────

let _seq = 0;
function _neueId() { return 'cl_' + Date.now().toString(36) + '_' + (_seq++).toString(36); }

// Wählt das nächste freie Paletten-Kürzel/Farbe (A, B, C … dann zyklisch).
function _naechsteVorlage() {
  const used = new Set(clusters.map(c => c.name));
  for (const v of CLUSTER_PALETTE) if (!used.has(v.name)) return v;
  return CLUSTER_PALETTE[clusters.length % CLUSTER_PALETTE.length];
}

export function clusterErstellen({ polygon, name, farbe, stufe = null, jahr = null, notiz = '' } = {}) {
  const vorlage = _naechsteVorlage();
  const cluster = {
    id: _neueId(),
    name: name || vorlage.name,
    farbe: farbe || vorlage.farbe,
    polygon: (polygon || []).map(_pt),
    stufe: stufe == null ? null : Number(stufe),
    jahr: jahr == null ? null : Number(jahr),
    notiz: notiz || '',
  };
  clusters.push(cluster);
  return cluster;
}

export function clusterFindeById(id) {
  return clusters.find(c => c.id === id) || null;
}

export function clusterAktualisieren(id, patch = {}) {
  const c = clusterFindeById(id);
  if (!c) return null;
  if (patch.name !== undefined)  c.name  = patch.name;
  if (patch.farbe !== undefined) c.farbe = patch.farbe;
  if (patch.notiz !== undefined) c.notiz = patch.notiz;
  if (patch.stufe !== undefined) c.stufe = patch.stufe === '' || patch.stufe == null ? null : Number(patch.stufe);
  if (patch.jahr !== undefined)  c.jahr  = patch.jahr  === '' || patch.jahr  == null ? null : Number(patch.jahr);
  if (patch.polygon !== undefined) c.polygon = (patch.polygon || []).map(_pt);
  return c;
}

export function clusterLoeschen(id) {
  const i = clusters.findIndex(c => c.id === id);
  if (i >= 0) clusters.splice(i, 1);
  return i >= 0;
}

// ── Maßnahmenpakete: Cluster → Einzelmaßnahmen auf den Mitgliedsgebäuden ────────────────
// Ein Cluster-Paket erzeugt je Mitgliedsgebäude eine Maßnahme pro gewähltem Typ. Die
// Maßnahmen tragen clusterId/clusterName, damit das Fahrplan-Board (14e) sie als Cluster-
// Swimlane gruppieren und die Generierung sie idempotent ersetzen kann. Typen entsprechen
// den Gewerk-Keys aus MASSN_VORLAGEN (Sanierung/Abriss/Bau), damit Farbe/Icon im Board passen.
export const CLUSTER_MASSN_TYPEN = ['Sanierung', 'Abriss', 'Bau'];

let _mSeq = 0;
function _neueMassnId() { return 'clm_' + Date.now().toString(36) + '_' + (_mSeq++).toString(36); }

// Alle vom Cluster erzeugten Maßnahmen (an m.clusterId erkennbar) aus allen Gebäuden entfernen.
// Gibt eine Map (buildingId|typ → {phaseId, jahr, id}) der entfernten zurück, damit der Aufrufer
// beim Neugenerieren die Phasen-/Jahr-Zuordnung des Nutzers erhalten kann.
export function clusterEntferneMassnahmen(cluster, gebaeudeArr) {
  const bewahrt = new Map();
  for (const g of (gebaeudeArr || [])) {
    if (!Array.isArray(g.massnahmen) || !g.massnahmen.length) continue;
    g.massnahmen = g.massnahmen.filter(m => {
      if (m && m.clusterId === cluster.id) {
        bewahrt.set(g.id + '|' + m.typ, { phaseId: m.phaseId || null, jahr: m.jahr ?? null, id: m.id });
        return false;
      }
      return true;
    });
  }
  return bewahrt;
}

// Erzeugt/aktualisiert die Maßnahmen dieses Clusters auf seinen Mitgliedsgebäuden.
// typen: Teilmenge von CLUSTER_MASSN_TYPEN. jahr: Ziel-Fertigstellung (default cluster.jahr).
// Bestehende, per Drag-&-Drop verplante Zuordnungen (phaseId/jahr/id) bleiben je (Gebäude,Typ)
// erhalten. Gibt { gebaeude, massnahmen } (Anzahlen) zurück.
export function clusterGeneriereMassnahmen(cluster, gebaeudeArr, { typen, jahr } = {}) {
  const gewaehlt = (typen && typen.length ? typen : ['Sanierung']).filter(t => CLUSTER_MASSN_TYPEN.includes(t));
  const zieljahr = jahr != null && jahr !== '' ? Number(jahr) : (cluster.jahr ?? null);
  const bewahrt = clusterEntferneMassnahmen(cluster, gebaeudeArr);
  const mitglieder = clusterMitgliedIds(cluster, gebaeudeArr);
  const idSet = new Set(mitglieder);

  let anzM = 0;
  for (const g of (gebaeudeArr || [])) {
    if (!idSet.has(g.id)) continue;
    if (!Array.isArray(g.massnahmen)) g.massnahmen = [];
    for (const typ of gewaehlt) {
      const key = g.id + '|' + typ;
      const alt = bewahrt.get(key);
      g.massnahmen.push({
        id:        alt?.id || _neueMassnId(),
        typ,
        titel:     typ + ' ' + (cluster.name ? 'Cluster ' + cluster.name : ''),
        kosten:    0,
        status:    'geplant',
        phaseId:   alt?.phaseId ?? null,
        jahr:      alt ? alt.jahr : zieljahr,
        dependsOn: [],
        clusterId:   cluster.id,
        clusterName: cluster.name,
      });
      anzM++;
    }
  }
  return { gebaeude: mitglieder.length, massnahmen: anzM };
}

// Zählt die von diesem Cluster erzeugten Maßnahmen über alle Gebäude.
export function clusterMassnahmenAnzahl(cluster, gebaeudeArr) {
  let n = 0;
  for (const g of (gebaeudeArr || [])) {
    for (const m of (g.massnahmen || [])) if (m.clusterId === cluster.id) n++;
  }
  return n;
}

// ── Zeitreise: Meilensteine + Zustand je Jahr (Schritt 3) ──────────────────────────────
// Effektives Jahr einer Maßnahme: explizites m.jahr gewinnt, sonst jahrVon der Phase
// (falls verplant), sonst null. phasenArr wird explizit übergeben (kein Global-Zugriff → testbar).
export function massnahmeEffektivesJahr(m, phasenArr) {
  if (m.jahr != null && m.jahr !== '') return Number(m.jahr);
  if (m.phaseId) {
    const p = (phasenArr || []).find(x => x.id === m.phaseId);
    if (p && p.jahrVon != null && p.jahrVon !== '') return parseInt(p.jahrVon);
  }
  return null;
}

// Sortierte, eindeutige Meilenstein-Jahre aus Cluster-Fertigstellungen und Maßnahmen.
export function fahrplanMeilensteine(clustersArr, gebaeudeArr, phasenArr) {
  const jahre = new Set();
  for (const c of (clustersArr || [])) if (c.jahr != null) jahre.add(Number(c.jahr));
  for (const g of (gebaeudeArr || [])) for (const m of (g.massnahmen || [])) {
    const j = massnahmeEffektivesJahr(m, phasenArr);
    if (j != null) jahre.add(j);
  }
  return [...jahre].sort((a, b) => a - b);
}

// Zustand der Liegenschaft bei einem Stichjahr: Cluster umgesetzt/geplant, Maßnahmen
// erledigt/gesamt, kumulierter Invest, sowie die Stufe(n), die genau in diesem Jahr fertig werden.
export function fahrplanZustandBeiJahr(jahr, clustersArr, gebaeudeArr, phasenArr) {
  const clusterStatus = {};
  for (const c of (clustersArr || [])) {
    clusterStatus[c.id] = (c.jahr != null && Number(c.jahr) <= jahr) ? 'umgesetzt' : 'geplant';
  }
  let done = 0, total = 0, invest = 0;
  const gebaeudeDone = new Set();
  for (const g of (gebaeudeArr || [])) {
    for (const m of (g.massnahmen || [])) {
      total++;
      const j = massnahmeEffektivesJahr(m, phasenArr);
      if (j != null && j <= jahr) { done++; invest += (m.kosten || 0); gebaeudeDone.add(g.id); }
    }
  }
  const stufen = (clustersArr || [])
    .filter(c => c.jahr != null && Number(c.jahr) === jahr && c.stufe != null)
    .map(c => c.stufe).sort((a, b) => a - b);
  return { clusterStatus, massnahmenDone: done, massnahmenTotal: total, investDone: invest, stufeJahr: stufen.length ? stufen[0] : null, gebaeudeDone };
}

// ── Persistenz (Projekt-JSON) ─────────────────────────────────────────────────────────

export function clusterSerialize() {
  return clusters.map(c => ({
    id: c.id, name: c.name, farbe: c.farbe,
    polygon: c.polygon.map(p => ({ lat: p.lat, lng: p.lng })),
    stufe: c.stufe, jahr: c.jahr, notiz: c.notiz,
  }));
}

export function clusterDeserialize(arr) {
  clusters.length = 0;
  for (const raw of (arr || [])) {
    clusters.push({
      id: raw.id || _neueId(),
      name: raw.name || '?',
      farbe: raw.farbe || '#607d8b',
      polygon: (raw.polygon || []).map(_pt),
      stufe: raw.stufe == null ? null : Number(raw.stufe),
      jahr: raw.jahr == null ? null : Number(raw.jahr),
      notiz: raw.notiz || '',
    });
  }
  return clusters;
}
