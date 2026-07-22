import { describe, expect, it } from 'vitest';
import { PROJECT_SCHEMA_VERSION, prepareProjectForImport, validateProjectData } from '../src/lib/project-schema.js';

const validProject = () => ({
  version: PROJECT_SCHEMA_VERSION,
  gebaeude: [{ id: 1, name: 'Haus', polygon: [
    { lat: 51, lng: 9 }, { lat: 51.001, lng: 9 }, { lat: 51, lng: 9.001 }
  ] }],
  trasse: [{ lat: 51, lng: 9 }, { lat: 51.001, lng: 9.001 }],
  trasseSegments: [{ start: 0, end: 1 }],
});

describe('Projekt-Schema', () => {
  it('akzeptiert ein minimales gültiges Projekt', () => {
    expect(validateProjectData(validProject())).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('lehnt eine neuere unbekannte Version ab', () => {
    const p = validProject(); p.version = PROJECT_SCHEMA_VERSION + 1;
    expect(validateProjectData(p).ok).toBe(false);
  });

  it('lehnt doppelte Gebäude-IDs ab', () => {
    const p = validProject(); p.gebaeude.push({ ...p.gebaeude[0] });
    expect(validateProjectData(p).errors.some(e => e.includes('doppelte Gebäude-ID'))).toBe(true);
  });

  it('lehnt ungültige Koordinaten ab', () => {
    const p = validProject(); p.gebaeude[0].polygon[0].lat = 120;
    expect(validateProjectData(p).errors.some(e => e.includes('Koordinaten'))).toBe(true);
  });

  it('lehnt Trassensegmente außerhalb des Punktearrays ab', () => {
    const p = validProject(); p.trasseSegments[0].end = 5;
    expect(validateProjectData(p).errors.some(e => e.includes('Punktebereich'))).toBe(true);
  });

  it('prepareProjectForImport liefert einen tiefen Klon', () => {
    const p = validProject();
    const prepared = prepareProjectForImport(p).project;
    prepared.gebaeude[0].name = 'Geändert';
    expect(p.gebaeude[0].name).toBe('Haus');
  });

  it('migriert historische v1-Projekte nach v2', () => {
    const p = validProject(); p.version = 1;
    const prepared = prepareProjectForImport(p);
    expect(prepared.project.version).toBe(2);
    expect(prepared.warnings.some(w => w.includes('migriert'))).toBe(true);
    expect(p.version).toBe(1);
  });

  it('akzeptiert einen vollständigen Wärmenetz-Graphen', () => {
    const p = validProject();
    p.waermeNetzGraph = {
      nodes: [
        { id: 1, type: 'geb', lat: 51, lng: 9, load: 20 },
        { id: 20000, type: 'junction', lat: 51.0005, lng: 9.0005, load: 0 }
      ],
      edges: [{ u: 1, v: 20000, dn: 40, pruned: false, waypoint: { lat: 51.0002, lng: 9.0001 } }]
    };
    expect(validateProjectData(p).ok).toBe(true);
  });

  it('lehnt Wärmenetz-Kanten mit unbekannten Knoten ab', () => {
    const p = validProject();
    p.waermeNetzGraph = {
      nodes: [{ id: 1, type: 'geb', lat: 51, lng: 9 }],
      edges: [{ u: 1, v: 999 }]
    };
    expect(validateProjectData(p).errors.some(e => e.includes('unbekannten Knoten'))).toBe(true);
  });
});
