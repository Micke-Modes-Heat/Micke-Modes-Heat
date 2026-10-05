// Vitest-Tests für die Verbrauchsauswertung (lib/bestandsanlage.js) und die Texte (lib/gutachten-verbrauch.js).
import { describe, it, expect } from 'vitest';
import { baVerbrauchAuswertung, baMixVerschiebung } from '../src/lib/bestandsanlage.js';
import { vbTextDaten, vbTextBezug, vbTextCo2, vbTextReferenzjahr } from '../src/lib/gutachten-verbrauch.js';
import { wtKlartext } from '../src/lib/gutachten-waerme-texte.js';

const text = abs => wtKlartext(abs);
const BA = {
  erzeuger: [
    { id: 'k1', typ: 'nt_gaskessel', aufloesung: 'stunde' }, { id: 'k2', typ: 'bw_gaskessel', aufloesung: 'stunde' },
    { id: 'p', typ: 'pelletkessel', aufloesung: 'monat' }, { id: 'b', typ: 'bhkw_gas', aufloesung: 'stunde' },
  ],
  verbrauch: [
    { jahr: 2021, werte: { k1: '3000', k2: '1000', p: '1000', b: '1000' } },
    { jahr: 2022, werte: { k1: '2000', k2: '500', p: '2500', b: '1000' } },
    { jahr: 2023, werte: { k1: '3000', k2: '1200', p: '900', b: '1000' } },
    { jahr: 2024, werte: { k1: '3200', k2: '1200', p: '700', b: '1050' } },
  ],
};

describe('baVerbrauchAuswertung', () => {
  const v = baVerbrauchAuswertung(BA);
  it('Gruppen, Mittel, Spanne', () => {
    expect(v.anzahlJahre).toBe(4);
    expect(v.gruppen.map(g => g.key)).toEqual(['Erdgas', 'Holzpellets', 'kwk']);
    expect(v.gruppen[0].mittelMwh).toBeCloseTo((4000 + 2500 + 4200 + 4400) / 4, 6);
    expect(v.minJahr.jahr).toBe(2021);
    expect(v.maxJahr.jahr).toBe(2024);
    expect(v.dominantJedesJahr).toBe(true);    // 2022: Kessel 2.500 = Pellets 2.500 → Kessel bleibt ≥
  });
  it('CO₂ nach GEG', () => {
    const j = v.jahre[0];
    expect(j.co2.Erdgas).toBeCloseTo(4000 * 240 / 1000, 6);
    expect(j.co2.Holzpellets).toBeCloseTo(1000 * 20 / 1000, 6);
    expect(j.co2.kwk).toBeCloseTo(1000 * 240 / 1000, 6);
  });
  it('Referenzjahr und Verschiebung', () => {
    expect([2021, 2023, 2024]).toContain(v.referenzJahr);
    const s = baMixVerschiebung(v);
    expect(s.jahr).toBe(2022);
    expect(s.rueckJahr.jahr).toBe(2024);
  });
});

describe('Texte', () => {
  const v = baVerbrauchAuswertung(BA);
  it('Datengrundlage mit Auflösung', () => {
    const t = text(vbTextDaten(v));
    expect(t).toContain('Für die Jahre 2021 bis 2024');
    expect(t).toContain('• den Erdgasbezug als Stundenwerte,');
    expect(t).toContain('• den Pelletverbrauch als Monatswerte.');
    expect(text(vbTextDaten(baVerbrauchAuswertung({})))).toContain('[Verbrauchsdaten');
  });
  it('Energiebezug und Energiekrise', () => {
    const t = text(vbTextBezug(v));
    expect(t).toContain('im Mittel bei rund 6.')
    expect(t).toContain('schwankt zwischen 6.000 MWh (2021)');
    expect(t).toContain('Dominierend ist über alle Jahre der Erdgasbezug der Kessel');
    expect(t).toContain('Der Pelletbezug stellt mit durchschnittlich rund');
    expect(t).toContain('das BHKW trägt mit rund');
    expect(t).toContain('vergleichsweise konstant');
    expect(t).toContain('Im Jahr 2022 ging der fossile Bezug deutlich zurück');
    expect(t).toContain('Energiekrise 2022');
    expect(t).toContain('Diese Verschiebung blieb jedoch nicht von Dauer: Bis 2024');
    expect(t).toContain('strukturell hohe und zuletzt erneut steigende Abhängigkeit');
  });
  it('CO₂ und Veranschaulichung', () => {
    const t = text(vbTextCo2(v));
    expect(t).toContain('240 g CO₂e/kWh für Erdgas und 20 g CO₂e/kWh für Holzpellets');
    expect(t).toContain('Erdumrundungen');
  });
  it('Referenzjahr', () => {
    expect(text(vbTextReferenzjahr(v, v.referenzJahr))).toContain('Dieses Jahr wird daher als Referenzzeitraum');
  });
});
