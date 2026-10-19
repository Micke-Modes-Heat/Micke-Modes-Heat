// Das Musterprojekt (data/demo_projekt.json) ist Einarbeitungsbeispiel und Testfall zugleich:
// Es muss den aktuellen Import bestehen, ohne Korrekturen auskommen und alle Kernwerte
// in plausiblen Bereichen halten. Der Roundtrip im echten Programm steht in
// tests-e2e/musterprojekt.spec.js.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_SCHEMA_VERSION, prepareProjectForImport, validateProjectData } from '../src/lib/project-schema.js';
import { pruefeGebaeude, pruefeParameter } from '../src/lib/plausibilitaet.js';

const datei = resolve(dirname(fileURLToPath(import.meta.url)), '../data/demo_projekt.json');
const text = readFileSync(datei, 'utf8');
const muster = () => JSON.parse(text);

describe('Musterprojekt', () => {
  it('besteht die Strukturprüfung in der aktuellen Schema-Version', () => {
    const p = muster();
    expect(p.version).toBe(PROJECT_SCHEMA_VERSION);
    expect(validateProjectData(p)).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('braucht beim Laden keine Korrekturen', () => {
    const { korrekturen, warnings } = prepareProjectForImport(muster());
    expect(korrekturen).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('ist anonymisiert', () => {
    const p = muster();
    expect(p.projektStammdaten.kaserneName).toBe('Musterliegenschaft Lindenhof');
    expect(p.projektStammdaten.liegenschaftAdresse).toContain('fiktiv');
    expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);   // keine Mailadressen
    expect(p.gebaeude.every(g => !g.fromOsm && !g.osmId)).toBe(true);
  });

  it('enthält Wärme- und Stromteil', () => {
    const p = muster();
    expect(p.gebaeude.length).toBeGreaterThanOrEqual(8);
    expect(p.netz.zentrale).toBeTruthy();
    expect(p.waermeNetzGraph.edges.length).toBeGreaterThan(0);
    expect(p.lwWp).toBeTruthy();
    expect(p.gasKessel).toBeTruthy();
    const typen = p.elektroAssets.items.map(a => a.type);
    for (const t of ['NAP', 'Schaltanlage', 'Trafo', 'PV', 'UV']) expect(typen, t).toContain(t);
    expect(p.elektroAssets.edges.length).toBeGreaterThan(0);
    const kwp = p.elektroAssets.items.filter(a => a.type === 'PV').reduce((s, a) => s + (a.props.leistungKWp || 0), 0);
    const trafoKva = p.elektroAssets.items.filter(a => a.type === 'Trafo').reduce((s, a) => s + (a.props.leistungKVA || 0), 0);
    expect(kwp).toBeGreaterThan(100);
    expect(kwp).toBeLessThan(trafoKva);   // PV passt zum Trafo
  });

  it('hält alle Kernwerte in plausiblen Bereichen', () => {
    const p = muster();
    const e = p.economicScenario.values;
    const werte = {
      'gk-eta': p.gasKessel.eta, 'lwwp-jaz': p.lwWp.jaz,
      'strom-emf': p.stromEmF, 'strom-emf-lz': p.stromEmFLZ, 'gas-emf': p.gasEmF, 'heizoel-emf': p.heizoelEmF,
      'fernwaerme-emf': p.fernwaermeEmF, 'pellets-emf': p.pelletsEmF, 'hhs-emf': p.hhsEmF,
      'wirt-p-strom': e.stromCtKwh, 'wirt-p-gas': e.gasCtKwh, 'wirt-p-hko': e.heizoelCtKwh, 'wirt-p-fw': e.fernwaermeCtKwh,
      'wirt-p-pk': e.pelletsCtKwh, 'wirt-p-hhs': e.hhsCtKwh, 'wirt-p-co2': e.co2EurT, 'wirt-zins': e.kapitalzinsPct,
    };
    expect(pruefeParameter(werte, ['gasKessel', 'lwWp'])).toEqual([]);
    expect(pruefeGebaeude(p.gebaeude)).toEqual([]);
  });
});
