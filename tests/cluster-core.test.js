// Vitest-Tests für 14f-cluster-core.js — Cluster-Datenmodell, Mitglieder, Persistenz.
// 14f ist importfrei/Leaflet-frei → direkt als ESM importierbar.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  clusters, pointInRingLL, ringCentroidLL, clusterMitgliedIds, clusterFuerGebaeude,
  clusterErstellen, clusterAktualisieren, clusterLoeschen,
  clusterSerialize, clusterDeserialize,
  clusterGeneriereMassnahmen, clusterEntferneMassnahmen, clusterMassnahmenAnzahl,
  massnahmeEffektivesJahr, fahrplanMeilensteine, fahrplanZustandBeiJahr,
} from '../src/14f-cluster-core.js';

// Einheitsquadrat (0,0)–(10,10) als Test-Polygon (lat/lng planar).
const quadrat = [
  { lat: 0, lng: 0 }, { lat: 0, lng: 10 },
  { lat: 10, lng: 10 }, { lat: 10, lng: 0 },
];
// Kleines Gebäude-Polygon um einen Mittelpunkt.
const geb = (id, lat, lng) => ({ id, polygon: [
  { lat: lat - 0.1, lng: lng - 0.1 }, { lat: lat - 0.1, lng: lng + 0.1 },
  { lat: lat + 0.1, lng: lng + 0.1 }, { lat: lat + 0.1, lng: lng - 0.1 },
] });

beforeEach(() => { clusters.length = 0; });

describe('Geometrie', () => {
  it('pointInRingLL erkennt innen/außen', () => {
    expect(pointInRingLL({ lat: 5, lng: 5 }, quadrat)).toBe(true);
    expect(pointInRingLL({ lat: 15, lng: 5 }, quadrat)).toBe(false);
  });
  it('pointInRingLL akzeptiert auch [lat,lng]-Arrays', () => {
    expect(pointInRingLL([5, 5], quadrat)).toBe(true);
  });
  it('ringCentroidLL mittelt die Ecken', () => {
    expect(ringCentroidLL(quadrat)).toEqual({ lat: 5, lng: 5 });
  });
});

describe('Mitglieder-Zuordnung', () => {
  it('nur Gebäude mit Schwerpunkt im Polygon zählen', () => {
    const c = clusterErstellen({ polygon: quadrat });
    const gebaeude = [geb('a', 5, 5), geb('b', 2, 8), geb('c', 20, 20)];
    const ids = clusterMitgliedIds(c, gebaeude);
    expect(ids.sort()).toEqual(['a', 'b']);
  });
  it('clusterFuerGebaeude findet das umschließende Cluster', () => {
    clusterErstellen({ polygon: quadrat, name: 'X' });
    expect(clusterFuerGebaeude(geb('a', 5, 5))?.name).toBe('X');
    expect(clusterFuerGebaeude(geb('c', 20, 20))).toBe(null);
  });
  it('Polygon mit <3 Punkten ergibt keine Mitglieder', () => {
    const c = clusterErstellen({ polygon: [{ lat: 0, lng: 0 }] });
    expect(clusterMitgliedIds(c, [geb('a', 0, 0)])).toEqual([]);
  });
});

describe('CRUD', () => {
  it('erstellt mit Paletten-Kürzel A, B, …', () => {
    expect(clusterErstellen({ polygon: quadrat }).name).toBe('A');
    expect(clusterErstellen({ polygon: quadrat }).name).toBe('B');
  });
  it('aktualisiert Felder inkl. Zahl-Coercion und Leerwert→null', () => {
    const c = clusterErstellen({ polygon: quadrat });
    clusterAktualisieren(c.id, { stufe: '4', jahr: '2038', name: 'C' });
    expect(c.stufe).toBe(4);
    expect(c.jahr).toBe(2038);
    expect(c.name).toBe('C');
    clusterAktualisieren(c.id, { stufe: '' });
    expect(c.stufe).toBe(null);
  });
  it('löscht per id', () => {
    const c = clusterErstellen({ polygon: quadrat });
    expect(clusterLoeschen(c.id)).toBe(true);
    expect(clusters.length).toBe(0);
  });
});

describe('Persistenz', () => {
  it('serialize → deserialize ist verlustfrei (round-trip)', () => {
    clusterErstellen({ polygon: quadrat, name: 'A', stufe: 4, jahr: 2038, notiz: 'Sanierung' });
    clusterErstellen({ polygon: quadrat, name: 'zentral' });
    const dump = clusterSerialize();
    clusterDeserialize(dump);
    expect(clusters.length).toBe(2);
    expect(clusters[0]).toMatchObject({ name: 'A', stufe: 4, jahr: 2038, notiz: 'Sanierung' });
    expect(clusters[0].polygon).toHaveLength(4);
  });
  it('serialize speichert KEINE Maßnahmen (die liegen auf den Gebäuden)', () => {
    const c = clusterErstellen({ polygon: quadrat, jahr: 2030 });
    const g = geb('a', 5, 5);
    clusterGeneriereMassnahmen(c, [g], { typen: ['Sanierung'] });
    expect(clusterSerialize()[0].massnahmen).toBeUndefined();
  });
  it('deserialize(null) leert die Liste', () => {
    clusterErstellen({ polygon: quadrat });
    clusterDeserialize(null);
    expect(clusters.length).toBe(0);
  });
  it('clusters-Binding bleibt stabil (in-place, kein Reassign)', () => {
    const ref = clusters;
    clusterDeserialize([{ name: 'A', polygon: quadrat }]);
    expect(ref).toBe(clusters);
    expect(ref.length).toBe(1);
  });
});

describe('Maßnahmenpakete (Mitglieder-Ebene)', () => {
  it('erzeugt je Mitglied eine Maßnahme pro Typ, getaggt mit clusterId', () => {
    const c = clusterErstellen({ polygon: quadrat, name: 'D', jahr: 2030 });
    const gs = [geb('a', 5, 5), geb('b', 2, 8), geb('c', 20, 20)]; // c außerhalb
    const res = clusterGeneriereMassnahmen(c, gs, { typen: ['Sanierung', 'Abriss'] });
    expect(res).toEqual({ gebaeude: 2, massnahmen: 4 });
    expect(gs[0].massnahmen).toHaveLength(2);
    expect(gs[2].massnahmen ?? []).toHaveLength(0);
    expect(gs[0].massnahmen[0]).toMatchObject({ typ: 'Sanierung', clusterId: c.id, clusterName: 'D', jahr: 2030 });
  });

  it('Jahr fällt auf cluster.jahr zurück, wenn nicht explizit übergeben', () => {
    const c = clusterErstellen({ polygon: quadrat, jahr: 2041 });
    const gs = [geb('a', 5, 5)];
    clusterGeneriereMassnahmen(c, gs, { typen: ['Sanierung'] });
    expect(gs[0].massnahmen[0].jahr).toBe(2041);
  });

  it('Neugenerierung ist idempotent (keine Duplikate) und erhält phaseId/jahr des Nutzers', () => {
    const c = clusterErstellen({ polygon: quadrat, jahr: 2030 });
    const gs = [geb('a', 5, 5)];
    clusterGeneriereMassnahmen(c, gs, { typen: ['Sanierung'] });
    // Nutzer verplant die Maßnahme in eine Phase
    gs[0].massnahmen[0].phaseId = 'ph_X';
    gs[0].massnahmen[0].jahr = 2035;
    const alteId = gs[0].massnahmen[0].id;
    // Erneut generieren (z.B. Typ Abriss dazu)
    clusterGeneriereMassnahmen(c, gs, { typen: ['Sanierung', 'Abriss'] });
    expect(gs[0].massnahmen).toHaveLength(2);
    const san = gs[0].massnahmen.find(m => m.typ === 'Sanierung');
    expect(san.phaseId).toBe('ph_X');
    expect(san.jahr).toBe(2035);
    expect(san.id).toBe(alteId);
  });

  it('Abwählen eines Typs entfernt dessen Maßnahmen', () => {
    const c = clusterErstellen({ polygon: quadrat });
    const gs = [geb('a', 5, 5)];
    clusterGeneriereMassnahmen(c, gs, { typen: ['Sanierung', 'Abriss'] });
    clusterGeneriereMassnahmen(c, gs, { typen: ['Sanierung'] });
    expect(gs[0].massnahmen).toHaveLength(1);
    expect(gs[0].massnahmen[0].typ).toBe('Sanierung');
  });

  it('clusterEntferneMassnahmen räumt alle Cluster-Maßnahmen weg, fremde bleiben', () => {
    const c = clusterErstellen({ polygon: quadrat });
    const gs = [geb('a', 5, 5)];
    gs[0].massnahmen = [{ id: 'fremd', typ: 'Bau' }]; // manuell, ohne clusterId
    clusterGeneriereMassnahmen(c, gs, { typen: ['Sanierung'] });
    expect(clusterMassnahmenAnzahl(c, gs)).toBe(1);
    clusterEntferneMassnahmen(c, gs);
    expect(clusterMassnahmenAnzahl(c, gs)).toBe(0);
    expect(gs[0].massnahmen).toHaveLength(1);
    expect(gs[0].massnahmen[0].id).toBe('fremd');
  });
});

describe('Zeitreise (Schritt 3)', () => {
  const phasen = [{ id: 'ph1', jahrVon: '2034' }];

  it('massnahmeEffektivesJahr: explizites Jahr gewinnt, sonst Phase, sonst null', () => {
    expect(massnahmeEffektivesJahr({ jahr: 2030 }, phasen)).toBe(2030);
    expect(massnahmeEffektivesJahr({ phaseId: 'ph1' }, phasen)).toBe(2034);
    expect(massnahmeEffektivesJahr({ jahr: 2030, phaseId: 'ph1' }, phasen)).toBe(2030);
    expect(massnahmeEffektivesJahr({}, phasen)).toBe(null);
  });

  it('fahrplanMeilensteine sammelt Cluster- und Maßnahmenjahre sortiert & eindeutig', () => {
    const c1 = clusterErstellen({ polygon: quadrat, jahr: 2030 });
    const c2 = clusterErstellen({ polygon: quadrat, jahr: 2041 });
    const gs = [geb('a', 5, 5)];
    gs[0].massnahmen = [{ typ: 'Sanierung', jahr: 2030 }, { typ: 'Bau', jahr: 2038 }, { typ: 'Abriss', phaseId: 'ph1' }];
    expect(fahrplanMeilensteine([c1, c2], gs, phasen)).toEqual([2030, 2034, 2038, 2041]);
  });

  it('fahrplanZustandBeiJahr: Cluster umgesetzt/geplant + kumulierter Invest', () => {
    const c1 = clusterErstellen({ polygon: quadrat, name: 'A', stufe: 2, jahr: 2030 });
    const c2 = clusterErstellen({ polygon: quadrat, name: 'B', stufe: 5, jahr: 2041 });
    const gs = [geb('a', 5, 5)];
    gs[0].massnahmen = [
      { typ: 'Sanierung', jahr: 2030, kosten: 1000 },
      { typ: 'Bau',       jahr: 2041, kosten: 5000 },
    ];
    const z = fahrplanZustandBeiJahr(2030, [c1, c2], gs, phasen);
    expect(z.clusterStatus[c1.id]).toBe('umgesetzt');
    expect(z.clusterStatus[c2.id]).toBe('geplant');
    expect(z.massnahmenDone).toBe(1);
    expect(z.massnahmenTotal).toBe(2);
    expect(z.investDone).toBe(1000);
    expect(z.stufeJahr).toBe(2);        // Cluster A wird 2030 fertig → Stufe 2
    expect([...z.gebaeudeDone]).toEqual(['a']);
  });

  it('fahrplanZustandBeiJahr am Endjahr: alles umgesetzt', () => {
    const c1 = clusterErstellen({ polygon: quadrat, jahr: 2030 });
    const gs = [geb('a', 5, 5)];
    gs[0].massnahmen = [{ typ: 'Sanierung', jahr: 2030, kosten: 1000 }, { typ: 'Bau', jahr: 2041, kosten: 5000 }];
    const z = fahrplanZustandBeiJahr(2041, [c1], gs, phasen);
    expect(z.massnahmenDone).toBe(2);
    expect(z.investDone).toBe(6000);
  });
});
