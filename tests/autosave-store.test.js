import { describe, expect, it } from 'vitest';
import { makeAutosaveSnapshot } from '../src/lib/autosave-store.js';

describe('Autosave-Metadaten', () => {
  it('speichert Zeitstempel und Schema-Version getrennt vom Projekt', () => {
    const project = {version: 1, gebaeude: []};
    expect(makeAutosaveSnapshot(project, 1234)).toEqual({savedAt: 1234, schemaVersion: 1, project});
  });
});
