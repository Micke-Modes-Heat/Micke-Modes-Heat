// ── 13d-assets-autocreate.js — Auto-Creation von Assets beim Gebäude-Zeichnen
// Beim Neuanlegen eines Gebäudes werden automatisch UV + Verbraucher + PV erzeugt.
// Alle sitzen am Polygon-Schwerpunkt und werden als Gruppen-Marker dargestellt
// (siehe 13b-assets-render.js).

import { ASSETS, createAsset, getAssetsForBuilding } from './13a-assets-core.js';
import { redrawAllAssets, isAssetLayerVisible } from './13b-assets-render.js';
import { findAutoK, kMeansCluster } from './15i-stromnetz-clustering.js';
import { createLeitungRouted } from './15b-stromnetz-draw.js';

function polygonCentroid(polygon) {
  if (!polygon || polygon.length < 1) return null;
  let lat = 0, lng = 0, n = 0;
  for (const p of polygon) {
    lat += (p.lat ?? p[0]);
    lng += (p.lng ?? p[1]);
    n++;
  }
  return n > 0 ? { lat: lat / n, lng: lng / n } : null;
}

const DEFAULT_TYPES = ['UV', 'Verbraucher', 'PV'];

export function autoCreateBuildingAssets(g, opts = {}) {
  if (!g || !g.polygon || g.polygon.length < 3) return [];
  // Opt-in: nur wenn User die Asset-Layer aktiviert hat
  if (!opts.force && !isAssetLayerVisible()) return [];
  // Duplikat-Schutz: skip wenn dieses Gebäude bereits Assets hat
  if (getAssetsForBuilding(g.id).length > 0) return [];

  const c = polygonCentroid(g.polygon);
  if (!c) return [];

  const base = {
    buildingId: g.id,
    baujahr:    g.baujahr    || null,
    abrissjahr: g.abrissjahr || null,
  };

  const created = [];
  for (const type of DEFAULT_TYPES) {
    const asset = createAsset(type, c.lat, c.lng, {
      ...base,
      name: `${type} ${g.name || g.id}`,
    });
    if (asset) created.push(asset);
  }
  if (created.length > 0) redrawAllAssets();
  return created;
}

// No-Op — Positionen kommen jetzt aus dem Polygon-Schwerpunkt,
// das berechnet der Renderer beim Zeichnen selbst.
export function reflowAutoAssets() {}

// Bei Layer-Aktivierung: für ALLE bestehenden Gebäude (auch aus Autosave-Restore)
// nachträglich Assets erzeugen, falls noch keine da sind.
export function ensureAssetsForAllBuildings() {
  const list = window.gebaeude || [];
  let created = 0;
  for (const g of list) {
    const before = ASSETS.items.length;
    autoCreateBuildingAssets(g, { force: true });
    created += ASSETS.items.length - before;
  }
  if (created > 0) redrawAllAssets();
  return created;
}

// ── Magic: Verbraucher + PV aus Gebäudedaten generieren ──────────────────────
// Versucht aus existierenden Gebäudedaten (stromJahr, heizlast, pvAktiv, pvKwp)
// sinnvolle leistungKW-Werte abzuleiten, damit die Heatmap & Strom-Berechnung
// gleich Daten haben. Skipt Gebäude, die bereits Verbraucher-/PV-Assets haben.
//
// Heuristik:
//   Verbraucher.leistungKW = stromJahr_kWh × 1,5 / 8760  (Spitzenlast-Faktor 1.5)
//                           Fallback: 5 kW pauschal
//   PV.leistungKWp         = g.pvKwp ?? Math.round(g.dachflaecheM2 * 0.15)  (15% Belegung × 1 kWp/m²)
//                           Nur wenn g.pvAktiv === true
//   UV                     = ohne Werte (Topologie)
export function magicCreateAssetsFromBuildings() {
  const list = window.gebaeude || [];
  if (!list.length) {
    if (typeof window.showHint === 'function') {
      window.showHint('Keine Gebäude vorhanden — bitte zuerst Gebäude laden.', 4000);
    }
    return 0;
  }

  let createdAssets = 0, updatedAssets = 0;

  for (const g of list) {
    if (!g || !g.polygon || g.polygon.length < 3) continue;
    const c = polygonCentroid(g.polygon);
    if (!c) continue;

    // Strom-Jahresverbrauch aus Gebäudedaten
    const stromKwh = parseFloat(g.stromJahr ?? g.stromkwh ?? 0) || 0;
    // Spitzenlast: 1,5× Mittelwert (grobe Annahme für gemischte Lastgänge)
    const verbraucherKw = stromKwh > 0 ? Math.round(stromKwh * 1.5 / 8760 * 10) / 10 : 5;

    // PV aus Gebäudedaten (kommt aus 03c-gebaeude-io: g.pvAktiv + abgeleitete kWp)
    const pvAktiv = !!g.pvAktiv;
    let pvKwp = 0;
    if (pvAktiv) {
      pvKwp = parseFloat(g.pvKwp ?? 0) || 0;
      if (pvKwp <= 0) {
        // Fallback: 15% der Grundfläche × 1 kWp/m² (sehr grobe Schätzung)
        const fl = parseFloat(g.flaeche ?? 0) || 0;
        if (fl > 0) pvKwp = Math.round(fl * 0.15);
      }
    }

    // Für jeden Standard-Typ: anlegen wenn noch nicht da; Werte beibehalten/aktualisieren
    const existing = ASSETS.items.filter(a => a.buildingId === g.id);

    // UV
    if (!existing.find(a => a.type === 'UV')) {
      createAsset('UV', c.lat, c.lng, { buildingId: g.id, name: `UV ${g.name || g.id}` });
      createdAssets++;
    }

    // Verbraucher mit leistungKW
    let v = existing.find(a => a.type === 'Verbraucher');
    if (!v) {
      v = createAsset('Verbraucher', c.lat, c.lng, {
        buildingId: g.id,
        name: `Verbraucher ${g.name || g.id}`,
        props: { leistungKW: verbraucherKw },
      });
      if (v) createdAssets++;
    } else if (!v.props || !(parseFloat(v.props.leistungKW) > 0)) {
      v.props = v.props || {};
      v.props.leistungKW = verbraucherKw;
      updatedAssets++;
    }

    // PV nur wenn pvAktiv und kWp > 0
    if (pvAktiv && pvKwp > 0) {
      let p = existing.find(a => a.type === 'PV');
      if (!p) {
        p = createAsset('PV', c.lat, c.lng, {
          buildingId: g.id,
          name: `PV ${g.name || g.id}`,
          props: { leistungKWp: pvKwp },
        });
        if (p) createdAssets++;
      } else if (!p.props || !(parseFloat(p.props.leistungKWp) > 0)) {
        p.props = p.props || {};
        p.props.leistungKWp = pvKwp;
        updatedAssets++;
      }
    }
  }

  if (createdAssets > 0 || updatedAssets > 0) redrawAllAssets();

  if (typeof window.showHint === 'function') {
    if (createdAssets === 0 && updatedAssets === 0) {
      window.showHint('Keine neuen Anlagen nötig — alle Gebäude haben bereits Verbraucher/PV-Werte.', 4000);
    } else {
      window.showHint(`✓ ${createdAssets} Anlagen erstellt, ${updatedAssets} aktualisiert (Werte aus Gebäudedaten).`, 5000);
    }
  }
  return createdAssets + updatedAssets;
}

// ── Magic Auto-Verkabelung (Vollhierarchie NAP → Trafo → NSHV → UV → Verbraucher) ──
// Schnelle 1-Klick-Operation, die für alle existierenden Verbraucher (+ optional PV)
// die fehlende Topologie aufbaut: UVs pro Gebäude, NSHV+Trafo per k-Means-Cluster,
// einen NAP am Quartiersrand. Leitungen direkt (Luftlinie) zwischen den Knoten.
//
// Annahmen:
//   - Mindestens 1 Verbraucher mit Position muss vorhanden sein (sonst Hint)
//   - Bestehende Trafos/NSHVs/UVs/NAPs werden BEHALTEN, nur fehlende ergänzt
//   - Keine Trassen — Leitungen folgen Luftlinie. Trassen kann der User später zeichnen,
//     dann via "Alle Leitungen neu routen" rerouten
//   - Trafo-Default: 400 kVA Bemessungsleistung
//   - Querschnitte: 50 mm² intern (UV→NSHV/Trafo), 95 mm² Trafo→NAP
export function magicAutoVerkabelung() {
  const verbraucher = ASSETS.items.filter(a =>
    (a.type === 'Verbraucher' || a.type === 'PV' || a.type === 'WP' || a.type === 'Lade')
    && a.lat != null && a.lng != null);
  if (verbraucher.length === 0) {
    if (typeof window.showHint === 'function') {
      window.showHint('Keine Verbraucher/PV/WP gefunden. Erst „🪄 Verbraucher aus Gebäuden erzeugen" oder Anlagen platzieren.', 5000);
    }
    return 0;
  }

  const counts = { uv: 0, nshv: 0, trafo: 0, nap: 0, leitungen: 0 };

  // ── 1. UV pro Gebäude (skip wenn schon vorhanden) ────────────────────────
  const uvByBuilding = new Map();
  const buildingIds = new Set();
  for (const a of verbraucher) if (a.buildingId) buildingIds.add(a.buildingId);

  for (const bid of buildingIds) {
    let uv = ASSETS.items.find(a => a.type === 'UV' && a.buildingId === bid);
    if (!uv) {
      const ref = verbraucher.find(a => a.buildingId === bid);
      const gebName = (window.gebaeude || []).find(g => g.id === bid)?.name || bid;
      uv = createAsset('UV', ref.lat, ref.lng, { buildingId: bid, name: `UV ${gebName}` });
      if (uv) counts.uv++;
    }
    if (uv) uvByBuilding.set(bid, uv);
  }

  // ── 2. Cluster-Punkte für k-Means (pro UV: Summe der Lasten am Gebäude) ──
  const clusterPoints = [];
  for (const [bid, uv] of uvByBuilding) {
    const verbsHere = verbraucher.filter(v => v.buildingId === bid);
    let sumKw = 0;
    for (const v of verbsHere) {
      if (v.type === 'PV') sumKw += (parseFloat(v.props?.leistungKWp) || 0) * 0.8;
      else                 sumKw += parseFloat(v.props?.leistungKW) || 0;
    }
    if (sumKw < 0.1) sumKw = 5; // Mindest-Lastpunkt damit k-Means ihn beachtet
    clusterPoints.push({ lat: uv.lat, lng: uv.lng, weight: sumKw, peakKW: sumKw, _uv: uv, _bid: bid });
  }
  // Standalone-Verbraucher (ohne buildingId) als eigene Punkte hinzufügen
  for (const a of verbraucher.filter(x => !x.buildingId)) {
    const kw = a.type === 'PV'
      ? (parseFloat(a.props?.leistungKWp) || 0) * 0.8
      : (parseFloat(a.props?.leistungKW)  || 0);
    clusterPoints.push({ lat: a.lat, lng: a.lng, weight: kw || 5, peakKW: kw || 5, _direct: a });
  }

  // ── 3. Trafos via k-Means (Default 400 kVA, cosPhi 0.9 → 360 kW Kapazität) ─
  const TRAFO_KVA = 400;
  let kInfo;
  try { kInfo = findAutoK(clusterPoints, TRAFO_KVA, 0.9, 1.0); } catch { kInfo = null; }
  const k = Math.max(1, kInfo?.k || 1);
  const clusters = kMeansCluster(clusterPoints, k, 150, 3, 1.0);

  // ── 4. Pro Cluster: Trafo + NSHV ─────────────────────────────────────────
  const clusterRefs = []; // [{trafo, nshv, points}]
  let cIdx = 0;
  for (const cl of clusters) {
    if (cl.points.length === 0) continue;
    cIdx++;
    // NSHV existiert vielleicht schon in der Nähe? → simple Logik: keine Wiederverwendung,
    // nur Skip wenn ein NSHV exakt am Centroid sitzt (sehr unwahrscheinlich).
    const nshv = createAsset('NSHV', cl.centroid.lat, cl.centroid.lng,
      { name: `NSHV ${cIdx}` });
    if (nshv) counts.nshv++;
    // Trafo leicht versetzt damit beide sichtbar sind
    const trafoLat = cl.centroid.lat + 0.00008;
    const trafo = createAsset('Trafo', trafoLat, cl.centroid.lng,
      { name: `Trafo ${cIdx}`, props: { leistungKVA: TRAFO_KVA } });
    if (trafo) counts.trafo++;
    clusterRefs.push({ trafo, nshv, points: cl.points });
  }

  // ── 5. NAP am Quartiers-Rand (Norden, mittig) ────────────────────────────
  let nap = ASSETS.items.find(a => a.type === 'NAP');
  if (!nap) {
    const lats = verbraucher.map(v => v.lat);
    const lngs = verbraucher.map(v => v.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    // 15% nördlich vom Quartier, mittig
    const napLat = maxLat + Math.max(0.0005, (maxLat - minLat) * 0.15);
    const napLng = (minLng + maxLng) / 2;
    nap = createAsset('NAP', napLat, napLng, { name: 'NAP' });
    if (nap) counts.nap++;
  }

  // ── 6. Leitungen ziehen (createLeitungRouted: Luftlinie wenn keine Trassen) ─
  function safeCreateLeitung(aId, bId, qs) {
    if (!aId || !bId || aId === bId) return;
    // Duplikat-Schutz: createLeitungRouted prüft selbst, gibt aber Hint aus → wir prüfen zuerst.
    const exists = ASSETS.edges.find(e => e.domain === 'strom' &&
      ((e.aId === aId && e.bId === bId) || (e.aId === bId && e.bId === aId)));
    if (exists) return;
    const lt = createLeitungRouted(aId, bId, { qs });
    if (lt) counts.leitungen++;
  }

  // 6a) Verbraucher/PV/WP/Lade → UV (gleiches Gebäude)
  for (const a of verbraucher) {
    if (!a.buildingId) continue;
    const uv = uvByBuilding.get(a.buildingId);
    if (uv) safeCreateLeitung(a.id, uv.id, 50);
  }
  // 6b) UV → NSHV (pro Cluster)
  for (const ref of clusterRefs) {
    for (const pt of ref.points) {
      if (pt._uv)    safeCreateLeitung(pt._uv.id, ref.nshv.id, 50);
      if (pt._direct) safeCreateLeitung(pt._direct.id, ref.nshv.id, 50);
    }
  }
  // 6c) NSHV → Trafo
  for (const ref of clusterRefs) {
    safeCreateLeitung(ref.nshv.id, ref.trafo.id, 50);
  }
  // 6d) Trafo → NAP (sammelnde Leitung, größerer Querschnitt)
  if (nap) {
    for (const ref of clusterRefs) {
      safeCreateLeitung(ref.trafo.id, nap.id, 95);
    }
  }

  redrawAllAssets();

  if (typeof window.showHint === 'function') {
    window.showHint(
      `✓ Auto-Netz: ${counts.uv} UV · ${counts.nshv} NSHV · ${counts.trafo} Trafo · ${counts.nap} NAP · ${counts.leitungen} Leitung(en).`,
      6000);
  }
  return counts;
}

// ── Komplett-Magic: Verbraucher + Auto-Netz in einem Klick ──────────────────
// Kettenreaktion: erst Verbraucher/PV aus Gebäudedaten anlegen, dann komplette
// Vollhierarchie (UV → NSHV → Trafo → NAP) verkabeln. Alles additiv —
// bestehende Anlagen bleiben.
export function magicKomplettStromnetz() {
  const before = ASSETS.items.length;
  magicCreateAssetsFromBuildings();
  const counts = magicAutoVerkabelung();
  const totalAssets = ASSETS.items.length - before;
  if (typeof window.showHint === 'function' && counts) {
    window.showHint(
      `✓ Komplett-Netz: ${totalAssets} neue Anlagen, ${counts.leitungen || 0} Leitung(en). Heatmap kann jetzt aktiviert werden.`,
      6000);
  }
  return counts;
}
