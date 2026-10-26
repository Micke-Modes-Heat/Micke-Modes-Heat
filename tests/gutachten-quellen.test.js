import { describe, expect, it } from 'vitest';
import { GQ_ABSCHNITTE, gqQuelle } from '../src/lib/gutachten-quellen.js';

describe('gqQuelle — Herkunft der Gutachten-Abbildungen', () => {
  it('ordnet Abbildungen ihrer Auswertungsseite zu', () => {
    expect(gqQuelle('lastgang-waerme')?.key).toBe('waerme');
    expect(gqQuelle('lastgang-strom-dauerlinie')?.key).toBe('strom');
    expect(gqQuelle('stromdaten-jahre')?.key).toBe('strom');
    expect(gqQuelle('bedarf-resultierend-wasserfall')?.key).toBe('nap');
    expect(gqQuelle('netzanschluss-text')?.key).toBe('netzanschluss');
    expect(gqQuelle('trafostationen-ist')?.key).toBe('ergebnisblatt');
    expect(gqQuelle('pv-energiebilanz')?.key).toBe('pva');
    expect(gqQuelle('kosten-jahre')?.key).toBe('ausbauplaner');
    expect(gqQuelle('va-kostenstruktur')?.key).toBe('wirtschaft');
    expect(gqQuelle('va-bewertungsmatrix')?.key).toBe('v:vergleich');
    expect(gqQuelle('gebaeude-baualter')?.key).toBe('v:gebaeude');
  });

  it('Emissionen gehen vor Verbrauch bzw. Variantenvergleich', () => {
    expect(gqQuelle('verbrauch-co2-text')?.key).toBe('emissionen');
    expect(gqQuelle('va-emissionen-kumuliert')?.key).toBe('emissionen');
    expect(gqQuelle('verbrauch-bezug-grafik')?.key).toBe('waerme');
  });

  it('ohne Rechnung im Tool kein Sprung', () => {
    expect(gqQuelle('potenzial-nicht-wind')).toBeNull();
    expect(gqQuelle('einleitung-ziele-text')).toBeNull();
    expect(gqQuelle('pv-resilienz')).toBeNull();
    expect(gqQuelle('res-sz1-text')).toBeNull();
    expect(gqQuelle('')).toBeNull();
  });

  it('jeder Treffer hat einen Titel', () => {
    for (const id of ['lastgang-waerme', 'netz-uebersicht-ist', 'elektro-massnahmen', 'fazit-fahrplan-gantt']) {
      const q = gqQuelle(id);
      expect(q && GQ_ABSCHNITTE[q.key]).toBe(q?.titel);
    }
  });
});
