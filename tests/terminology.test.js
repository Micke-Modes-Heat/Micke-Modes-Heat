import { describe,expect,it } from 'vitest';
import { UI_TERMS } from '../src/config/terminology.js';

describe('Nutzerbegriffe',()=>{
  it('legt die zentralen Fachbegriffe eindeutig fest',()=>{
    expect(UI_TERMS).toMatchObject({
      heatTrunk:'Wärme-Haupttrasse',electricCorridor:'Elektro-Korridor',
      automaticNetwork:'Netz automatisch erzeugen',pruning:'Netzabschnitte ausschließen',
      dispatch:'stündliche Einsatzplanung',screening:'überschlägige Vorprüfung',
    });
  });
});
